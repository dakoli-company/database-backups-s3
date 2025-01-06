# Build Stage
FROM alpine:latest AS build

WORKDIR /root

RUN apk add --update --no-cache nodejs npm

COPY package*.json ./

RUN npm install
RUN npm prune --production

# Final Stage
FROM alpine:latest

WORKDIR /root

# Copy from build stage
COPY --from=build /root/node_modules ./node_modules

# Copy application code
COPY ./ /root

# Install PostgreSQL
RUN apk add --update --no-cache postgresql16-client nodejs npm

ENTRYPOINT ["node", "index.js"]
