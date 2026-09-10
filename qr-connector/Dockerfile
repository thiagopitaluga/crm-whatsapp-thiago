FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && update-ca-certificates \
  && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && git config --global --add url."https://github.com/".insteadOf "git@github.com:" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src

ENV PORT=3001
ENV AUTH_DIR=/app/data/auth

RUN mkdir -p /app/data/auth && chown -R node:node /app
USER node

EXPOSE 3001
CMD ["npm", "start"]
