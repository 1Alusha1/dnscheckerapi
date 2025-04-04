# Используйте официальный Node.js образ
FROM node:latest

WORKDIR /app

# Копируйте package.json и package-lock.json для установки зависимостей
COPY . .

# Установите зависимости
RUN npm install

# Убедитесь, что контейнер слушает на правильном порту
EXPOSE 8080

# Запустите приложение
CMD ["npm","run","start"]
