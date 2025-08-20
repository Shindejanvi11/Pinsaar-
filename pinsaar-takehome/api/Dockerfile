FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm i
COPY src ./src
COPY public ./public
EXPOSE 3000
CMD ["node", "src/index.js"]
