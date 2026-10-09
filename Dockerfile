# Trang tĩnh, phục vụ bằng nginx ở cổng 3000 (Dokploy trỏ domain vào cổng này).
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY assets /usr/share/nginx/html/assets
COPY frames /usr/share/nginx/html/frames

EXPOSE 3000
