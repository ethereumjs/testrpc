FROM node:14.15-alpine3.12 as builder

RUN apk add --no-cache make gcc g++ python git bash
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
WORKDIR /app
RUN git config --global url.https://github.com/.insteadOf ssh://git@github.com/
RUN npm ci
COPY . .
RUN npx webpack-cli --config ./webpack/webpack.docker.config.js

FROM node:14.15-alpine3.12 as runtime

WORKDIR /app

COPY --from=builder "/app/build/ganache-core.docker.cli.js" "./ganache-core.docker.cli.js"
COPY --from=builder "/app/build/ganache-core.docker.cli.js.map" "./ganache-core.docker.cli.js.map"

ENV DOCKER true

EXPOSE 8545

ENTRYPOINT ["node", "/app/ganache-core.docker.cli.js"]
