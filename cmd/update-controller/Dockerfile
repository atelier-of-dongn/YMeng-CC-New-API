FROM golang:1.25.1-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY relaykit/go.mod relaykit/go.mod
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /update-controller ./cmd/update-controller

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /update-controller /usr/local/bin/update-controller
# Docker Engine's Unix socket is mounted with host-controlled permissions. The
# controller is isolated from the public network and is the only service that
# receives this socket; deployers should apply a socket proxy or matching group
# instead of granting it to the public application containers.
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/update-controller"]
