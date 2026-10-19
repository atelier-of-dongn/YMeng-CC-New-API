package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const catFKResponseLimit = 2 << 20

type catFKHTTPAdapter struct {
	baseURL string
}

func newCatFKHTTPAdapter() *catFKHTTPAdapter {
	return &catFKHTTPAdapter{baseURL: "https://catfk.com"}
}

// The documented order receipt binds trade, shop, goods, amount and quantity.
// Channel and currency are optional upstream fields, never invented evidence.
// Paid delivery still requires both payment confirmation and the exact local code.
func (*catFKHTTPAdapter) Ready() bool { return true }

func (a *catFKHTTPAdapter) client(credentials CatFKCredentials) (*http.Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, ErrCatFKOrderUnavailable
	}
	origin, err := url.Parse(a.baseURL)
	if err != nil {
		return nil, ErrCatFKOrderUnavailable
	}
	if credentials.Cookie != "" {
		var cookies []*http.Cookie
		if common.UnmarshalJsonStr(credentials.Cookie, &cookies) != nil {
			return nil, ErrCatFKVerification
		}
		jar.SetCookies(origin, cookies)
	}
	return &http.Client{Timeout: 25 * time.Second, Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, nil
}

type catFKEnvelope struct {
	Code *int            `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

// Reads share a 15-second budget and at most three attempts. Creation always
// gets exactly one attempt, even if the server accepted it before a disconnect.
func (a *catFKHTTPAdapter) post(ctx context.Context, client *http.Client, visitor, path string, request, result any) error {
	body, err := common.Marshal(request)
	if err != nil {
		return ErrCatFKInvalidRequest
	}
	attempts := 3
	if path == "/shopApi/Pay/order" {
		attempts = 1
	} else {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
	}
	for attempt := range attempts {
		if ctx.Err() != nil {
			return ErrCatFKOrderUnavailable
		}
		attemptCtx := ctx
		cancel := func() {}
		if attempts > 1 {
			attemptCtx, cancel = context.WithTimeout(ctx, 5*time.Second)
		}
		envelope, retry, callErr := a.postOnce(attemptCtx, client, visitor, path, body)
		cancel()
		if callErr != nil {
			if retry && attempt+1 < attempts {
				continue
			}
			return callErr
		}
		if path == "/shopApi/Pay/query" {
			// Payment confirmation is represented by the envelope code itself.
			payment, ok := result.(*catFKEnvelope)
			if !ok {
				return ErrCatFKInvalidRequest
			}
			*payment = *envelope
			return nil
		}
		if *envelope.Code != 1 {
			return ErrCatFKOrderUnavailable
		}
		if common.Unmarshal(envelope.Data, result) != nil {
			return ErrCatFKVerification
		}
		return nil
	}
	return ErrCatFKOrderUnavailable
}

func (a *catFKHTTPAdapter) postOnce(ctx context.Context, client *http.Client, visitor, path string, body []byte) (*catFKEnvelope, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, false, ErrCatFKOrderUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	req.Header.Set("Origin", a.baseURL)
	req.Header.Set("Referer", a.baseURL+"/")
	if visitor != "" {
		req.Header.Set("Visitorid", visitor)
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, true, ErrCatFKOrderUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		retry := response.StatusCode == http.StatusRequestTimeout || response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500
		return nil, retry, ErrCatFKOrderUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, catFKResponseLimit+1))
	if err != nil || len(data) > catFKResponseLimit {
		return nil, err != nil, ErrCatFKOrderUnavailable
	}
	var envelope catFKEnvelope
	if common.Unmarshal(data, &envelope) != nil || envelope.Code == nil {
		return nil, true, ErrCatFKOrderUnavailable
	}
	return &envelope, false, nil
}

type catFKShop struct {
	Token    string `json:"token"`
	Nickname string `json:"nickname"`
	Link     string `json:"link"`
}

type catFKGoods struct {
	Key           string    `json:"goods_key"`
	Type          string    `json:"goods_type"`
	Status        int       `json:"status"`
	ContactFormat string    `json:"contact_format"`
	User          catFKShop `json:"user"`
	Extend        struct {
		StockCount *int `json:"stock_count"`
		LimitCount int  `json:"limit_count"`
	} `json:"extend"`
}

type catFKChannelWire struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	ShowName     string `json:"show_name"`
	Status       int    `json:"status"`
	CustomStatus int    `json:"custom_status"`
	Paytype      struct {
		Icon string `json:"icon"`
	} `json:"paytype"`
}

func (a *catFKHTTPAdapter) Channels(ctx context.Context, token string) ([]operation_setting.CatFKChannel, error) {
	token, err := operation_setting.NormalizeCatFKStoreToken(token)
	if err != nil || token == "" {
		return nil, ErrCatFKInvalidRequest
	}
	client, err := a.client(CatFKCredentials{})
	if err != nil {
		return nil, err
	}
	var wire []catFKChannelWire
	if err = a.post(ctx, client, "", "/shopApi/Shop/getUserChannel", map[string]any{"token": token}, &wire); err != nil {
		return nil, err
	}
	channels := make([]operation_setting.CatFKChannel, 0, len(wire))
	seen := make(map[int]bool, len(wire))
	for _, channel := range wire {
		if channel.ID <= 0 || channel.Status != 1 || channel.CustomStatus != 1 {
			continue
		}
		if seen[channel.ID] {
			return nil, ErrCatFKVerification
		}
		seen[channel.ID] = true
		name := channel.ShowName
		if name == "" {
			name = channel.Name
		}
		if name == "" {
			return nil, ErrCatFKVerification
		}
		icon := channel.Paytype.Icon
		if !catFKValidPaymentURL(icon) {
			icon = ""
		}
		channels = append(channels, operation_setting.CatFKChannel{ID: strconv.Itoa(channel.ID), Name: name, Icon: icon})
	}
	return channels, nil
}

func (a *catFKHTTPAdapter) Quote(ctx context.Context, token, goodsKey, channelID string) (*CatFKOffer, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	token, err := operation_setting.NormalizeCatFKStoreToken(token)
	id, idErr := strconv.Atoi(channelID)
	if err != nil || token == "" || goodsKey == "" || idErr != nil || id <= 0 || strconv.Itoa(id) != channelID {
		return nil, ErrCatFKInvalidRequest
	}
	client, err := a.client(CatFKCredentials{})
	if err != nil {
		return nil, err
	}
	var shop catFKShop
	if err = a.post(ctx, client, "", "/shopApi/Shop/info", map[string]any{"token": token}, &shop); err != nil {
		return nil, err
	}
	if shop.Token != token || shop.Link != "https://catfk.com/shop/"+token {
		return nil, ErrCatFKVerification
	}
	var goods catFKGoods
	if err = a.post(ctx, client, "", "/shopApi/Shop/goodsInfo", map[string]any{"goods_key": goodsKey}, &goods); err != nil {
		return nil, err
	}
	if goods.Key != goodsKey || goods.User.Token != token || goods.Type != "card" || goods.Status != 1 || (goods.ContactFormat != "any" && goods.ContactFormat != "qq") || goods.Extend.LimitCount != 1 {
		return nil, ErrCatFKVerification
	}
	// The detail endpoint omits stock. Verify the exact product in the shop's
	// paginated list; a missing stock field is not proof of availability.
	inStock := false
	found := false
	for page := 1; page <= 50; page++ {
		var list struct {
			Total int          `json:"total"`
			List  []catFKGoods `json:"list"`
		}
		if err = a.post(ctx, client, "", "/shopApi/Shop/goodsList", map[string]any{"token": token, "goods_type": "card", "current": page, "pageSize": 20}, &list); err != nil {
			return nil, err
		}
		for _, item := range list.List {
			if item.Key != goodsKey {
				continue
			}
			if found || item.Type != "card" || item.User.Token != token || item.Extend.StockCount == nil || *item.Extend.StockCount < 0 {
				return nil, ErrCatFKVerification
			}
			found = true
			inStock = *item.Extend.StockCount > 0
		}
		if found || len(list.List) == 0 || page*20 >= list.Total {
			break
		}
	}
	if !found {
		return nil, ErrCatFKVerification
	}
	channels, err := a.Channels(ctx, token)
	if err != nil {
		return nil, err
	}
	available := false
	for _, channel := range channels {
		if channel.ID == channelID {
			available = true
			break
		}
	}
	if !available {
		return nil, ErrCatFKVerification
	}
	var price struct {
		OriginalAmount *decimal.Decimal `json:"original_amount"`
		Fee            *decimal.Decimal `json:"fee"`
		TotalAmount    *decimal.Decimal `json:"total_amount"`
	}
	if err = a.post(ctx, client, "", "/shopApi/Shop/getGoodsPrice", map[string]any{"goods_key": goodsKey, "quantity": 1, "coupon_code": "", "channel_id": id}, &price); err != nil {
		return nil, err
	}
	if price.TotalAmount == nil || !price.TotalAmount.IsPositive() || price.TotalAmount.GreaterThan(decimal.NewFromInt(1000000000)) {
		return nil, ErrCatFKVerification
	}
	offer := &CatFKOffer{ShopID: token, ShopName: shop.Nickname, ShopURL: shop.Link, ProductID: goodsKey, ChannelID: channelID, Amount: price.TotalAmount.String(), Currency: "CNY", Quantity: 1, InStock: inStock}
	// The fee is display-only; it is kept only when the breakdown adds up.
	if price.OriginalAmount != nil && price.Fee != nil && price.OriginalAmount.IsPositive() && !price.Fee.IsNegative() && price.OriginalAmount.Add(*price.Fee).Equal(*price.TotalAmount) {
		offer.OriginalAmount, offer.Fee = price.OriginalAmount.String(), price.Fee.String()
	}
	return offer, nil
}

func (a *catFKHTTPAdapter) Create(ctx context.Context, order *model.CatFKOrder, credentials CatFKCredentials, qq string) (*CatFKCreatedOrder, error) {
	channelID, err := strconv.Atoi(order.ChannelID)
	if err != nil || channelID <= 0 || strconv.Itoa(channelID) != order.ChannelID || credentials.Visitor == "" || credentials.Password == "" || len(qq) == 0 || len(qq) > 32 || strings.Trim(qq, "0123456789") != "" {
		return nil, ErrCatFKInvalidRequest
	}
	client, err := a.client(credentials)
	if err != nil {
		return nil, err
	}
	var wire struct {
		TradeNo     string           `json:"trade_no"`
		PayURL      string           `json:"payurl"`
		TotalAmount *decimal.Decimal `json:"total_amount"`
	}
	err = a.post(ctx, client, credentials.Visitor, "/shopApi/Pay/order", map[string]any{"goods_key": order.ProductID, "quantity": 1, "coupon_code": "", "channel_id": channelID, "contact": qq, "query_password": credentials.Password, "select_cards_ids": []int{}, "extend": map[string]any{}}, &wire)
	origin, _ := url.Parse(a.baseURL)
	cookies, sealErr := common.Marshal(client.Jar.Cookies(origin))
	if sealErr != nil {
		return nil, ErrCatFKOrderUnavailable
	}
	credentials.Cookie = string(cookies)
	result := &CatFKCreatedOrder{UpstreamOrderID: wire.TradeNo, PaymentURL: wire.PayURL, Credentials: &credentials}
	if err != nil {
		return result, err
	}
	if wire.TradeNo == "" || !catFKValidPaymentURL(wire.PayURL) || wire.TotalAmount == nil {
		return result, ErrCatFKVerification
	}
	expected, priceErr := decimal.NewFromString(order.PriceAmount)
	if priceErr != nil || !wire.TotalAmount.Equal(expected) {
		return result, ErrCatFKVerification
	}
	copy := *order
	copy.UpstreamOrderID = &wire.TradeNo
	evidence, err := a.query(ctx, &copy, credentials, client)
	if evidence != nil {
		result.Evidence = *evidence
	}
	if err == nil {
		// The QR code is optional; callers fall back to the payment URL.
		result.PaymentQRCode, _ = a.paymentQRCode(ctx, wire.PayURL)
	}
	// Capture cookies from both creation and its immediate verification query.
	cookies, sealErr = common.Marshal(client.Jar.Cookies(origin))
	if sealErr != nil {
		return result, ErrCatFKOrderUnavailable
	}
	credentials.Cookie = string(cookies)
	return result, err
}

// paymentQRCode silently opens the payment page, as a browser would, and reads
// the QR code of the Alipay desktop cashier: catfk redirects to a page that
// auto-submits a form to the Alipay gateway, which redirects to the cashier
// holding the code in <input name="qrCode">. Only catfk and Alipay are visited.
func (a *catFKHTTPAdapter) paymentQRCode(ctx context.Context, payURL string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	origin, err := url.Parse(a.baseURL)
	if err != nil {
		return "", ErrCatFKOrderUnavailable
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return "", ErrCatFKOrderUnavailable
	}
	client := &http.Client{Timeout: 15 * time.Second, Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	method, target, form := http.MethodGet, payURL, url.Values(nil)
	for range 8 {
		u, err := url.Parse(target)
		if err != nil || u.User != nil || !(u.Scheme == origin.Scheme && u.Host == origin.Host || u.Scheme == "https" && strings.HasSuffix(u.Hostname(), ".alipay.com") && u.Port() == "") {
			return "", ErrCatFKVerification
		}
		var body io.Reader
		if method == http.MethodPost {
			body = strings.NewReader(form.Encode())
		}
		req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
		if err != nil {
			return "", ErrCatFKOrderUnavailable
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
		if method == http.MethodPost {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		response, err := client.Do(req)
		if err != nil {
			return "", ErrCatFKOrderUnavailable
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, catFKResponseLimit+1))
		response.Body.Close()
		if err != nil || len(data) > catFKResponseLimit {
			return "", ErrCatFKOrderUnavailable
		}
		if response.StatusCode >= 300 && response.StatusCode < 400 {
			next, err := u.Parse(response.Header.Get("Location"))
			if err != nil || response.Header.Get("Location") == "" {
				return "", ErrCatFKVerification
			}
			method, target, form = http.MethodGet, next.String(), nil
			continue
		}
		if response.StatusCode != http.StatusOK {
			return "", ErrCatFKOrderUnavailable
		}
		doc, err := html.Parse(bytes.NewReader(data))
		if err != nil {
			return "", ErrCatFKVerification
		}
		var formNode *html.Node
		for n := range doc.Descendants() {
			if n.Type != html.ElementNode {
				continue
			}
			if n.DataAtom == atom.Input && catFKHTMLAttr(n, "name") == "qrCode" {
				code := strings.TrimSpace(catFKHTMLAttr(n, "value"))
				if len(code) > 2048 || !catFKValidPaymentURL(code) {
					return "", ErrCatFKVerification
				}
				return code, nil
			}
			if n.DataAtom == atom.Form && formNode == nil {
				formNode = n
			}
		}
		if formNode == nil {
			return "", ErrCatFKVerification
		}
		next, err := u.Parse(catFKHTMLAttr(formNode, "action"))
		if err != nil {
			return "", ErrCatFKVerification
		}
		form = url.Values{}
		for n := range formNode.Descendants() {
			if n.Type == html.ElementNode && n.DataAtom == atom.Input && catFKHTMLAttr(n, "name") != "" && catFKHTMLAttr(n, "type") != "submit" {
				form.Add(catFKHTMLAttr(n, "name"), catFKHTMLAttr(n, "value"))
			}
		}
		method, target = http.MethodGet, next.String()
		if strings.EqualFold(catFKHTMLAttr(formNode, "method"), http.MethodPost) {
			method = http.MethodPost
		} else {
			next.RawQuery = form.Encode()
			target, form = next.String(), nil
		}
	}
	return "", ErrCatFKVerification
}

func catFKHTMLAttr(n *html.Node, key string) string {
	for _, attr := range n.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}
	return ""
}

func (a *catFKHTTPAdapter) Query(ctx context.Context, order *model.CatFKOrder, credentials CatFKCredentials) (*CatFKOrderEvidence, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, err := a.client(credentials)
	if err != nil {
		return nil, err
	}
	return a.query(ctx, order, credentials, client)
}

func (a *catFKHTTPAdapter) query(ctx context.Context, order *model.CatFKOrder, credentials CatFKCredentials, client *http.Client) (*CatFKOrderEvidence, error) {
	if order.UpstreamOrderID == nil || *order.UpstreamOrderID == "" {
		// The platform has no verified lookup by our local idempotency key.
		return nil, ErrCatFKOrderUnavailable
	}
	var wire struct {
		TradeNo     string           `json:"trade_no"`
		Status      *int             `json:"status"`
		TotalAmount *decimal.Decimal `json:"total_amount"`
		Quantity    *int             `json:"quantity"`
		Sendout     *int             `json:"sendout"`
		ChannelID   *int             `json:"channel_id"`
		Currency    string           `json:"currency"`
		Goods       catFKGoods       `json:"goods"`
		User        catFKShop        `json:"user"`
		Response    struct {
			Cards []string `json:"cards"`
		} `json:"response"`
	}
	if err := a.post(ctx, client, credentials.Visitor, "/shopApi/Order/info", map[string]any{"trade_no": *order.UpstreamOrderID, "query_password": credentials.Password, "dump": 1}, &wire); err != nil {
		return nil, err
	}
	if wire.TradeNo != *order.UpstreamOrderID || wire.Status == nil || wire.TotalAmount == nil || !wire.TotalAmount.IsPositive() || wire.Quantity == nil || *wire.Quantity != 1 || wire.Goods.Type != "card" || wire.Goods.Key == "" || wire.User.Token == "" || (wire.ChannelID != nil && (*wire.ChannelID <= 0 || strconv.Itoa(*wire.ChannelID) != order.ChannelID)) || (wire.Currency != "" && wire.Currency != order.Currency) {
		return nil, ErrCatFKVerification
	}
	if *wire.Status < 0 || *wire.Status > 3 || *wire.Status == 3 {
		return nil, ErrCatFKVerification
	}
	channelID := ""
	if wire.ChannelID != nil {
		channelID = strconv.Itoa(*wire.ChannelID)
	}
	evidence := &CatFKOrderEvidence{UpstreamOrderID: wire.TradeNo, ShopID: wire.User.Token, ProductID: wire.Goods.Key, ChannelID: channelID, Quantity: *wire.Quantity, Amount: wire.TotalAmount.String(), Currency: wire.Currency, Paid: *wire.Status == 1, Expired: *wire.Status == 2}
	if evidence.Paid {
		var payment catFKEnvelope
		if err := a.post(ctx, client, credentials.Visitor, "/shopApi/Pay/query", map[string]any{"trade_no": *order.UpstreamOrderID}, &payment); err != nil {
			return nil, err
		}
		if *payment.Code != 1 {
			// Payment and order endpoints may update at different times. Never
			// settle on a redirect, a user assertion, or one stale paid response.
			return nil, ErrCatFKOrderUnavailable
		}
		if wire.Sendout == nil || *wire.Sendout < 0 || *wire.Sendout > 1 || len(wire.Response.Cards) > 1 {
			return nil, ErrCatFKVerification
		}
		evidence.Delivered = *wire.Sendout == 1
		if evidence.Delivered {
			if len(wire.Response.Cards) != 1 {
				return nil, ErrCatFKVerification
			}
			evidence.RedemptionKey = wire.Response.Cards[0]
		}
	}
	return evidence, nil
}
