FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json server.js ./

ENV NODE_ENV=production
ENV PORT=8091

EXPOSE 8091

CMD ["node", "server.js"]
