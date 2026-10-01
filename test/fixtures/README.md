Certificados autofirmados SOLO para las pruebas del cliente (servidor HTTPS falso). No protegen nada.
Regenerar: openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 36500 -subj "/CN=pve-test"
