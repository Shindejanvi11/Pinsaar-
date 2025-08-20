FROM node:18-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm i
COPY src ./src
EXPOSE 5000
CMD ["node", "src/index.js"]
