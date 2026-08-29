# Une seule étape : il n'y a rien à compiler. Node 25 lit le TypeScript
# directement, le client est en modules ES servis tels quels, et le projet
# n'a aucune dépendance à installer.
FROM node:25-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

COPY packages ./packages
COPY server   ./server
COPY client   ./client
COPY games    ./games
COPY i18n     ./i18n
COPY cli      ./cli
COPY fixtures ./fixtures
COPY package.json README.md ./

# La base vit dans un volume : l'image reste jetable.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/main.ts"]
