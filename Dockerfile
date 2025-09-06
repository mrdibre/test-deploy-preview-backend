FROM node:18-alpine

RUN npm install -g pnpm@9.4.0

WORKDIR /app

COPY package*.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile --prod

COPY . .

EXPOSE 3000

USER node

CMD ["pnpm", "start"]
