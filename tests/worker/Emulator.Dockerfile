FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f
COPY --from=eclipse-temurin:21-jre-jammy@sha256:affcab5356e1270ac35d2361ee83135af2f03e8d580eca78a6d5d6fdbf048db0 /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:$PATH
RUN npm install --global firebase-tools@15.34.0
WORKDIR /emulator
COPY firebase.emulators.json ./
COPY tests/database/current-live.rules tests/database/storage.rules ./tests/database/
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('firebase.emulators.json'));p.emulators.firestore.host='0.0.0.0';p.emulators.storage.host='0.0.0.0';p.emulators.ui={enabled:false};fs.writeFileSync('firebase.emulators.json',JSON.stringify(p))"
CMD ["firebase","emulators:start","--project","demo-myscouter-readiness","--only","firestore,storage","--config","firebase.emulators.json"]
