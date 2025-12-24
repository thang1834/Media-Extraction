# Getting Started

Hướng dẫn cài đặt và khởi động nhanh Media Extraction API.

## Yêu Cầu

- **Node.js** >= 18
- **npm** hoặc **pnpm**

## Cài Đặt

### 1. Clone Repository

```bash
git clone <repository-url>
cd Media-Extraction
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Cấu Hình Environment

Copy file `.env.example` thành `.env`:

```bash
cp .env.example .env
```

Chỉnh sửa `.env` và thêm ít nhất:

```env
API_URL=http://localhost:9000
```

Xem [Configuration Guide](configuration.md) để biết tất cả các options.

### 4. Khởi Động Server

```bash
npm start
```

Server sẽ chạy tại `http://localhost:9000` (hoặc port bạn đã cấu hình).

### 5. Kiểm Tra Server

```bash
# Health check
curl http://localhost:9000/health

# Server info
curl http://localhost:9000/
```

## Quick Test

Test với một video YouTube:

```bash
curl -X POST http://localhost:9000/ \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "videoQuality": "1080"
  }'
```

## Next Steps

- Xem [API Reference](api-reference.md) để biết cách sử dụng API
- Xem [Examples](examples.md) để xem code examples
- Xem [Configuration](configuration.md) để tùy chỉnh server

