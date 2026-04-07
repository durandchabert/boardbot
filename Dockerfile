FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# Install all dependencies
RUN npm ci

# Copy source
COPY shared/ shared/
COPY backend/ backend/
COPY frontend/ frontend/

# Build frontend
RUN npm run build --workspace=frontend

# Expose port
ENV PORT=3001
EXPOSE 3001

# Start backend (tsx runs TypeScript directly)
CMD ["npx", "tsx", "backend/src/server.ts"]
