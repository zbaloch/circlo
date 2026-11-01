package com.circlo.server.web;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * Error responses carry a fixed code (and fixed details) only. Nothing from the request (names, emails, passwords,
 * text) is echoed back or logged, and stack traces never leave the server.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(LockedException.class)
    ResponseEntity<Map<String, Object>> locked(LockedException e) {
        return ResponseEntity.status(e.status()).header("Retry-After", Long.toString(e.retryAfterSeconds())).body(body(e));
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> api(ApiException e) {
        return ResponseEntity.status(e.status()).body(body(e));
    }

    private static Map<String, Object> body(ApiException e) {
        Map<String, Object> out = new LinkedHashMap<>(e.details());
        out.put("error", e.getMessage());
        return out;
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class,
            HandlerMethodValidationException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<Map<String, String>> invalid(Exception e) {
        return ResponseEntity.badRequest().body(Map.of("error", "invalid_request"));
    }

    @ExceptionHandler(org.springframework.dao.DuplicateKeyException.class)
    ResponseEntity<Map<String, String>> duplicate(Exception e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "conflict"));
    }
}
