# =============================================================================
# Dockerfile — Internal Tool API (API Tester Pro)
# Môi trường Build & Đóng gói Desktop App (Wails v2 + React 18 + Go)
#
# Docker được dùng làm Build Environment chuẩn hóa, xuất ra binary (.exe / ELF).
#
# Cách sử dụng:
#   1. Qua Docker Compose (Dễ nhất):
#        docker compose run --rm build-windows   # Xuất file .exe ra thư mục ./dist/
#        docker compose run --rm build-linux     # Xuất binary Linux ra ./dist/
#        docker compose run --rm shell           # Vào container terminal để test/debug
#
#   2. Qua Docker BuildKit (Trực tiếp, không cần chạy container):
#        docker build --build-arg TARGET=windows --target export --output type=local,dest=./dist .
# =============================================================================

# ─── Stage 1: Base Image (Go + Node.js + C / GTK / WebKit Toolchain) ─────────
ARG GO_VERSION=1.24
FROM golang:${GO_VERSION}-bullseye AS base

ARG NODE_VERSION=20
ARG WAILS_VERSION=v2.12.0

LABEL maintainer="TuansHuynh <nkoc.nho.17.04@gmail.com>"
LABEL description="Build environment for Internal API Client — API Tester Pro"
LABEL version="2.6.0"

# Cài đặt toàn bộ system packages, thư viện WebKitGTK 4.0 và Node.js trong 1 layer tối ưu
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    build-essential \
    pkg-config \
    libgtk-3-dev \
    libwebkit2gtk-4.0-dev \
    gcc \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && node -v && npm -v \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Cài đặt Wails CLI
RUN go install github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}

WORKDIR /app

# ─── Stage 2: Dependencies Caching Layer ──────────────────────────────────────
# Tận dụng cache Docker: Chỉ download lại khi file go.mod/sum hoặc package.json thay đổi
FROM base AS deps

# Cache Go modules
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Cache Frontend packages
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --prefer-offline

# ─── Stage 3: Builder ─────────────────────────────────────────────────────────
FROM deps AS builder

ARG TARGET=windows

# Copy toàn bộ source code của dự án
COPY . .

# Đồng bộ version và build frontend (Vite)
RUN cd frontend && npm run build

# Build updater & ứng dụng Wails theo nền tảng chỉ định
RUN if [ "$TARGET" = "windows" ]; then \
        echo "==> [1/2] Building Windows Updater (updater.exe)..." && \
        mkdir -p internal/updater/bin && \
        CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
        go build -trimpath -ldflags="-s -w -buildid=" -o internal/updater/bin/updater.exe ./cmd/updater/ && \
        echo "==> [2/2] Building Windows Wails App (.exe)..." && \
        CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
        wails build -platform windows/amd64 -s -trimpath -ldflags "-s -w -buildid="; \
    else \
        echo "==> [1/2] Building Linux Updater..." && \
        mkdir -p internal/updater/bin && \
        go build -trimpath -ldflags="-s -w -buildid=" -o internal/updater/bin/updater ./cmd/updater/ && \
        echo "==> [2/2] Building Linux Wails App..." && \
        wails build -platform linux/amd64 -s -trimpath -ldflags "-s -w -buildid="; \
    fi

# Chuẩn bị thư mục /export chứa tất cả binaries sẵn sàng để sao chép ra host
RUN mkdir -p /export && \
    cp -r /app/build/bin/. /export/ && \
    cp -r /app/internal/updater/bin/. /export/

# ─── Stage 4: Export — Xuất trực tiếp file binary ra máy host (BuildKit) ──────
FROM scratch AS export

COPY --from=builder /export/ /
