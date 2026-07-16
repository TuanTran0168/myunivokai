FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

FROM alpine:3.22

WORKDIR /app

RUN adduser -D -H myunivokai
COPY --from=build /out/api /app/api

USER myunivokai

EXPOSE 8081
CMD ["/app/api"]
