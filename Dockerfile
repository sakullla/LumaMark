FROM node:22-alpine
WORKDIR /app
COPY apps/server ./apps/server
RUN test -s apps/server/public/index.html \
  && test -s apps/server/public/web.js \
  && grep -q 'startWebApp()' apps/server/public/index.html \
  && grep -q '/web.js' apps/server/public/index.html
ENV LUMAMARK_DATA=/data
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "apps/server/server.mjs"]
