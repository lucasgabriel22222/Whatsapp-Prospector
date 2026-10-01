@echo off
echo Parando container...
docker stop evolution-api
docker rm evolution-api
echo Recriando com volume mapeado D:\evolution-store...
docker run -d --name evolution-api -p 8081:8080 ^
  -v "D:/evolution-store:/evolution/store" ^
  -e AUTHENTICATION_API_KEY=minhasenhasecreta123 ^
  -e SERVER_URL=http://localhost:8081 ^
  -e TZ=America/Sao_Paulo ^
  -e DOCKER_ENV=true ^
  -e SERVER_TYPE=http ^
  -e SERVER_PORT=8080 ^
  -e CORS_ORIGIN=* ^
  -e "CORS_METHODS=POST,GET,PUT,DELETE" ^
  -e CORS_CREDENTIALS=true ^
  -e "LOG_LEVEL=ERROR,WARN,DEBUG,INFO,LOG,VERBOSE,DARK,WEBHOOKS" ^
  -e LOG_COLOR=true ^
  -e LOG_BAILEYS=error ^
  -e DEL_INSTANCE=false ^
  -e DEL_TEMP_INSTANCES=true ^
  -e STORE_MESSAGES=true ^
  -e STORE_MESSAGE_UP=true ^
  -e STORE_CONTACTS=true ^
  -e STORE_CHATS=true ^
  -e CLEAN_STORE_CLEANING_INTERVAL=7200 ^
  -e CLEAN_STORE_MESSAGES=true ^
  -e CLEAN_STORE_MESSAGE_UP=true ^
  -e CLEAN_STORE_CONTACTS=true ^
  -e CLEAN_STORE_CHATS=true ^
  -e DATABASE_ENABLED=false ^
  -e AUTHENTICATION_TYPE=apikey ^
  -e AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true ^
  -e AUTHENTICATION_INSTANCE_MODE=server ^
  -e CONFIG_SESSION_PHONE_CLIENT=EvolutionAPI ^
  -e CONFIG_SESSION_PHONE_NAME=Chrome ^
  -e QRCODE_LIMIT=30 ^
  -e "QRCODE_COLOR=#198754" ^
  -e WPP_LID_MODE=false ^
  evoapicloud/evolution-api:v1.8.2
echo.
docker ps --filter name=evolution-api
echo.
echo Aguarde 15 segundos e acesse localhost:8081/manager para reconectar
pause
