# בנייה והגשה של מנוע הטריוויה כאתר סטטי (CapRover / כל Docker host)

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# קובצי ההתקנה של תוכנת האופליין נמשכים **לתוך התמונה**, כדי שהלקוח יוריד
# ויתעדכן מהשרת הזה בלבד ולא יפנה ל-GitHub. המשיכה קורית כאן — בצד השרת,
# בזמן הבנייה — ונכשלת ברעש אם קובץ חסר או שה-sha512 אינו תואם ל-latest.yml.
# ARG לביטול (‎--build-arg DESKTOP_ASSETS=0‎) לבנייה מקומית מהירה.
ARG DESKTOP_ASSETS=1
ENV DESKTOP_ASSETS=$DESKTOP_ASSETS
RUN node tools/fetch-desktop-assets.mjs dist/desktop

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
