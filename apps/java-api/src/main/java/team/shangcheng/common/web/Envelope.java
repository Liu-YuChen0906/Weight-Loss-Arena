package team.shangcheng.common.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.core.MethodParameter;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.*;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

@RestControllerAdvice(basePackages = "team.shangcheng")
public class Envelope implements ResponseBodyAdvice<Object> {

    private final ObjectMapper json;

    public Envelope(ObjectMapper json) {
        // Use a local mapper so adding requestId cannot strip BigDecimal scale.
        this.json = json
            .copy()
            .configure(
                com.fasterxml.jackson.databind.cfg.JsonNodeFeature.STRIP_TRAILING_BIGDECIMAL_ZEROES,
                false
            );
    }

    public boolean supports(MethodParameter p, Class<? extends HttpMessageConverter<?>> type) {
        return true;
    }

    public Object beforeBodyWrite(
        Object body,
        MethodParameter p,
        MediaType t,
        Class<? extends HttpMessageConverter<?>> c,
        ServerHttpRequest r,
        ServerHttpResponse s
    ) {
        if (body == null) return null;
        var tree = json.valueToTree(body);
        if (tree instanceof ObjectNode object) {
            Object requestId = ((ServletServerHttpRequest) r).getServletRequest().getAttribute(
                "requestId"
            );
            object.put("requestId", requestId == null ? null : requestId.toString());
            return object;
        }
        return body;
    }
}
