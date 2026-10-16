"""Private sqlite-web entrypoint; upstream CLI supplies password and database."""
from urllib.parse import urlsplit

from flask import abort, request
from sqlite_web import sqlite_web


def configure():
    options = sqlite_web.configure_app()
    if options.get('host') != '127.0.0.1' or not sqlite_web.app.config.get('PASSWORD'):
        raise RuntimeError('Database administration requires loopback and a password')
    sqlite_web.app.config.update(
        TRUSTED_HOSTS=['127.0.0.1', 'localhost'],
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Strict',
        MAX_CONTENT_LENGTH=1024 * 1024,
    )

    @sqlite_web.app.before_request
    def same_origin_writes():
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return
        if request.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
            abort(403)
        origin = request.headers.get('Origin')
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme != request.scheme or parsed.netloc != request.host:
                abort(403)

    return sqlite_web.app, options


if __name__ == '__main__':
    app, options = configure()
    app.run(**options)
