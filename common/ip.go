package common

import (
	"net"
	"strings"

	"github.com/gin-gonic/gin"
)

// ClientCountryHeader 是 CDN 透传的访问国家码请求头；边缘节点从 Cloudflare
// CF-IPCountry 归一化后透传给上游。
const ClientCountryHeader = "X-Client-Country"

// cloudflareCountryHeader 是 Cloudflare 原生国家码请求头，作为回退来源。
const cloudflareCountryHeader = "CF-IPCountry"

// GetClientCountry 读取 CDN 透传的访问国家码：优先 X-Client-Country，回退 CF-IPCountry。
// 归一化为两位大写字母；XX（未知）、T1（Tor）等标记与非法值返回空字符串，
// 避免把任意请求头内容当作地区存储或回显。
func GetClientCountry(c *gin.Context) string {
	if c == nil {
		return ""
	}
	country := normalizeCountryCode(c.GetHeader(ClientCountryHeader))
	if country != "" {
		return country
	}
	return normalizeCountryCode(c.GetHeader(cloudflareCountryHeader))
}

func normalizeCountryCode(country string) string {
	country = strings.ToUpper(strings.TrimSpace(country))
	if len(country) != 2 {
		return ""
	}
	for i := 0; i < len(country); i++ {
		if country[i] < 'A' || country[i] > 'Z' {
			return ""
		}
	}
	// Cloudflare 用 XX 表示无法识别，T1 表示 Tor 出口节点，两者都不是真实地区。
	if country == "XX" || country == "T1" {
		return ""
	}
	return country
}

func IsIP(s string) bool {
	ip := net.ParseIP(s)
	return ip != nil
}

func ParseIP(s string) net.IP {
	return net.ParseIP(s)
}

func IsPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}

	private := []net.IPNet{
		{IP: net.IPv4(10, 0, 0, 0), Mask: net.CIDRMask(8, 32)},
		{IP: net.IPv4(172, 16, 0, 0), Mask: net.CIDRMask(12, 32)},
		{IP: net.IPv4(192, 168, 0, 0), Mask: net.CIDRMask(16, 32)},
	}

	for _, privateNet := range private {
		if privateNet.Contains(ip) {
			return true
		}
	}
	return false
}

func IsIpInCIDRList(ip net.IP, cidrList []string) bool {
	for _, cidr := range cidrList {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			// 尝试作为单个IP处理
			if whitelistIP := net.ParseIP(cidr); whitelistIP != nil {
				if ip.Equal(whitelistIP) {
					return true
				}
			}
			continue
		}

		if network.Contains(ip) {
			return true
		}
	}
	return false
}
