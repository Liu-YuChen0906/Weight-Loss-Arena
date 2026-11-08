package team.shangcheng.common.web;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.common.Problem;
import team.shangcheng.common.ResponseDetails;

@Slf4j
@RestControllerAdvice
public class Errors {

    @ExceptionHandler(Problem.class)
    ResponseEntity<?> problem(Problem p, HttpServletRequest r) {
        return ResponseEntity.status(p.status).body(
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
                r.getAttribute("requestId")
            )
        );
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> json(Exception e, HttpServletRequest r) {
        return problem(new Problem(400, "INVALID_JSON", "请求内容无法读取"), r);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<?> type(Exception e, HttpServletRequest r) {
        return problem(new Problem(415, "UNSUPPORTED_MEDIA_TYPE", "请使用JSON请求"), r);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<?> method(Exception e, HttpServletRequest r) {
        return problem(new Problem(405, "METHOD_NOT_ALLOWED", "不支持此操作"), r);
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<?> db(Exception e, HttpServletRequest r) {
        return problem(
            new Problem(503, "DEPENDENCY_UNAVAILABLE", "服务暂时不可用，请稍后核对操作结果"),
            r
        );
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<?> unknown(Exception e, HttpServletRequest r) {
        var frames = java.util.Arrays.stream(e.getStackTrace())
            .filter(f -> f.getClassName().startsWith("team.shangcheng."))
            .limit(8)
            .toList();
        log.error(
            "requestId={} errorType={} frames={}",
            r.getAttribute("requestId"),
            e.getClass().getSimpleName(),
            frames
        );
        return problem(new Problem(500, "INTERNAL_ERROR", "服务暂时出现问题，请核对操作结果"), r);
    }
}
