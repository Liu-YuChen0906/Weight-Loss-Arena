package team.shangcheng.common.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.session.web.http.DefaultCookieSerializer;
import team.shangcheng.common.ResponseDetails;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain chain(HttpSecurity http, ObjectMapper json) throws Exception {
        var repository = new HttpSessionCsrfTokenRepository();
        repository.setHeaderName("X-CSRF-Token");
        http
            .authorizeHttpRequests(a -> a.anyRequest().permitAll())
            .csrf(c ->
                c
                    .csrfTokenRepository(repository)
                    .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler())
                    .ignoringRequestMatchers(
                        "/api/v1/auth/code",
                        "/api/v1/auth/login",
                        "/api/v1/auth/test-login"
                    )
            )
            .exceptionHandling(e ->
                e.accessDeniedHandler((r, s, x) -> {
                    s.setStatus(403);
                    s.setContentType("application/json");
                    json.writeValue(
                        s.getOutputStream(),
                        ResponseDetails.map(
                            "error",
                            ResponseDetails.map(
                                "code",
                                "CSRF_REJECTED",
                                "message",
                                "登录状态已变化，请重新登录"
                            ),
                            "requestId",
                            r.getAttribute("requestId")
                        )
                    );
                })
            )
            .headers(h ->
                h.contentSecurityPolicy(c ->
                    c.policyDirectives(
                        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
                    )
                )
            )
            .httpBasic(b -> b.disable())
            .formLogin(f -> f.disable())
            .logout(l -> l.disable());
        return http.build();
    }

    @Bean
    DefaultCookieSerializer cookie(
        @Value("${server.servlet.session.cookie.secure:false}") boolean secure
    ) {
        var s = new DefaultCookieSerializer();
        s.setCookieName("cq_session");
        s.setCookiePath("/");
        s.setSameSite("Strict");
        s.setUseHttpOnlyCookie(true);
        s.setUseSecureCookie(secure);
        s.setCookieMaxAge(604800);
        return s;
    }
}
