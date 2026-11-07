FROM node:22-alpine
WORKDIR /app
COPY apps/server ./apps/server
ENV LUMAMARK_DATA=/data
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "apps/server/server.mjs"]
