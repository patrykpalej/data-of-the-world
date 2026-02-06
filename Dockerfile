FROM node:18-slim

WORKDIR /app

# Install build tools (sqlite3 is only for optional debugging)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ sqlite3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY src/package*.json ./

# Install dependencies using lockfile
RUN npm ci --only=production --no-audit --no-fund

# Copy application files
COPY src/ .

EXPOSE 8004

CMD ["npm", "start"]
