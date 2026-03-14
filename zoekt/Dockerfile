FROM golang:1.24-bookworm AS build

ARG ZOEKT_REF=c747a3bccc2a4a427204ac08eea62a522df6d2ec

RUN go install github.com/sourcegraph/zoekt/cmd/zoekt-git-index@${ZOEKT_REF} \
  && go install github.com/sourcegraph/zoekt/cmd/zoekt-webserver@${ZOEKT_REF}

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /go/bin/zoekt-git-index /usr/local/bin/zoekt-git-index
COPY --from=build /go/bin/zoekt-webserver /usr/local/bin/zoekt-webserver
COPY ./index-repos.sh /usr/local/bin/index-repos.sh

RUN chmod +x /usr/local/bin/index-repos.sh

WORKDIR /data

CMD ["zoekt-webserver", "-listen", ":6070", "-index", "/data/index"]
