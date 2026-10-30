package com.circlo.server.web;

import com.circlo.server.crypto.CoreException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Error responses carry a fixed code only. Nothing from the request (handles, ciphertext, IDs) is echoed back or
 * logged, and stack traces never leave the server.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(LockedException.class)
    ResponseEntity<Map<String, Object>> locked(LockedException e) {
        return ResponseEntity.status(e.status()).header("Retry-After", Long.toString(e.retryAfterSeconds()))
                .body(Map.of("error", e.getMessage(), "retryAfter", e.retryAfterSeconds()));
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, String>> api(ApiException e) {
        return ResponseEntity.status(e.status()).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    ResponseEntity<Map<String, String>> invalid(Exception e) {
        return ResponseEntity.badRequest().body(Map.of("error", "invalid_request"));
    }

    @ExceptionHandler(CoreException.class)
    ResponseEntity<Map<String, String>> core(CoreException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "invalid_request"));
    }

    @ExceptionHandler(org.springframework.dao.DuplicateKeyException.class)
    ResponseEntity<Map<String, String>> duplicate(Exception e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "conflict"));
    }
}
