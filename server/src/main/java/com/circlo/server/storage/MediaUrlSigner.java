package com.circlo.server.storage;

import java.net.URL;
import java.security.SecureRandom;
import java.util.HexFormat;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** Issues short-lived presigned URLs. Object keys are random; they never encode user data. */
@Component
public class MediaUrlSigner {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final S3Presigner presigner;
    private final S3Properties props;

    public MediaUrlSigner(S3Presigner presigner, S3Properties props) {
        this.presigner = presigner;
        this.props = props;
    }

    /** 32 random bytes, hex encoded. */
    public static String newObjectKey() {
        byte[] key = new byte[32];
        RANDOM.nextBytes(key);
        return HexFormat.of().formatHex(key);
    }

    public URL presignPut(String objectKey) {
        return presigner.presignPutObject(r -> r
                .signatureDuration(props.putTtl())
                .putObjectRequest(PutObjectRequest.builder().bucket(props.bucket()).key(objectKey).build()))
                .url();
    }

    /**
     * PUT locked to an exact Content-Length and Content-Type: the uploader can't store more than it declared, and the
     * file is served back with the declared type.
     */
    public URL presignPut(String objectKey, long contentLength, String contentType) {
        return presigner.presignPutObject(r -> r
                .signatureDuration(props.putTtl())
                .putObjectRequest(PutObjectRequest.builder().bucket(props.bucket()).key(objectKey)
                        .contentLength(contentLength).contentType(contentType).build()))
                .url();
    }

    public URL presignGet(String objectKey) {
        return presigner.presignGetObject(r -> r
                .signatureDuration(props.getTtl())
                .getObjectRequest(GetObjectRequest.builder().bucket(props.bucket()).key(objectKey).build()))
                .url();
    }

    /** A GET URL as a string, or null for no object. */
    public String url(String objectKey) {
        return objectKey == null ? null : presignGet(objectKey).toString();
    }
}
