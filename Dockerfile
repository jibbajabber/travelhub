# Use Node.js for building the application
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build the Vite frontend
COPY . .
RUN npm run build

# --- Runtime Stage ---
FROM node:20-slim

WORKDIR /app

# Copy only necessary files for runtime from the builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/config ./config

# Expose the application port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["npm", "run", "dev"]
