package team.shangcheng.common.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.net.URI;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import team.shangcheng.common.Problem;
import team.shangcheng.common.ResponseDetails;
import team.shangcheng.privacy.journal.PrivacyJournal;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class RequestFilter extends OncePerRequestFilter {

    private final ObjectMapper json;
    private final PrivacyJournal journal;
    private final String origin;
    private final boolean expose;
    private final String instance;

    public RequestFilter(
        ObjectMapper json,
        PrivacyJournal journal,
        @Value("${app.origin}") String origin,
        @Value("${app.expose-instance}") boolean expose,
        @Value("${app.instance-id}") String instance
    ) {
        this.json = json;
        this.journal = journal;
        this.origin = origin;
        this.expose = expose;
        this.instance = instance;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest r, HttpServletResponse s, FilterChain chain)
        throws ServletException, IOException {
        String id = UUID.randomUUID().toString();
        r.setAttribute("requestId", id);
        s.setHeader("X-Request-Id", id);
        s.setHeader("Cache-Control", "no-store");
        s.setHeader("X-Content-Type-Options", "nosniff");
        s.setHeader("X-Frame-Options", "DENY");
        s.setHeader("Referrer-Policy", "same-origin");
        if (expose) s.setHeader("X-Test-Instance", instance);
        try {
            String host = r.getServerName();
            String allowed = URI.create(origin).getHost();
            if (
                !host.equals(allowed) && !Set.of("localhost", "127.0.0.1", "[::1]").contains(host)
            ) throw new Problem(403, "HOST_REJECTED", "访问来源不被允许");
            if (
                r.getHeader("Origin") != null && !r.getHeader("Origin").equals(origin)
            ) throw new Problem(403, "HOST_REJECTED", "请从应用页面操作");
            boolean write = Set.of("POST", "PUT", "PATCH", "DELETE").contains(r.getMethod());
            HttpServletRequest request = r;
            if (write) {
                if (!"1".equals(r.getHeader("X-App-Request"))) throw new Problem(
                    403,
                    "HOST_REJECTED",
                    "请从应用页面操作"
                );
                if (
                    r.getContentType() == null ||
                    !r.getContentType().split(";")[0].strip().equalsIgnoreCase("application/json")
                ) throw new Problem(415, "UNSUPPORTED_MEDIA_TYPE", "请使用JSON请求");
                byte[] body = r.getInputStream().readNBytes(16385);
                if (body.length > 16384) throw new Problem(413, "BODY_TOO_LARGE", "请求内容过长");
                try {
                    if (!json.readTree(body).isObject()) throw new IOException();
                } catch (Exception e) {
                    throw new Problem(400, "INVALID_JSON", "请求须为JSON对象");
                }
                request = new BodyRequest(r, body);
            }
            if (r.getRequestURI().equals("/api/v1/health")) {
                chain.doFilter(request, s);
                return;
            }
            try (var gate = journal.enter()) {
                chain.doFilter(request, s);
            }
        } catch (Problem p) {
            s.setStatus(p.status);
            s.setContentType("application/json;charset=UTF-8");
            json.writeValue(
                s.getOutputStream(),
                ResponseDetails.map(
                    "error",
                    ResponseDetails.map(
                        "code",
                        p.code,
                        "message",
                        p.getMessage(),
                        "details",
                        p.details
                    ),
                    "requestId",
                    id
                )
            );
        } catch (org.springframework.data.redis.RedisConnectionFailureException e) {
            s.setStatus(503);
            s.setContentType("application/json;charset=UTF-8");
            json.writeValue(
                s.getOutputStream(),
                ResponseDetails.map(
                    "error",
                    ResponseDetails.map(
                        "code",
                        "DEPENDENCY_UNAVAILABLE",
                        "message",
                        "登录服务暂时不可用"
                    ),
                    "requestId",
                    id
                )
            );
        }
    }

    private static class BodyRequest extends HttpServletRequestWrapper {

        final byte[] body;

        BodyRequest(HttpServletRequest r, byte[] body) {
            super(r);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            var in = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                public int read() {
                    return in.read();
                }

                public boolean isFinished() {
                    return in.available() == 0;
                }

                public boolean isReady() {
                    return true;
                }

                public void setReadListener(ReadListener l) {
                    throw new UnsupportedOperationException();
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            return new BufferedReader(
                new InputStreamReader(getInputStream(), java.nio.charset.StandardCharsets.UTF_8)
            );
        }
    }
}
