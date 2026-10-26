package com.halqo.server.storage;

import java.util.OptionalLong;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

/** Object metadata checks. The server never downloads or inspects media bodies (they're ciphertext anyway). */
@Component
public class MediaStore {

    private final S3Client s3;
    private final S3Properties props;

    public MediaStore(S3Client s3, S3Properties props) {
        this.s3 = s3;
        this.props = props;
    }

    /** Size of the stored object, or empty if it doesn't exist. */
    public OptionalLong size(String objectKey) {
        try {
            return OptionalLong.of(s3.headObject(HeadObjectRequest.builder().bucket(props.bucket()).key(objectKey).build())
                    .contentLength());
        } catch (NoSuchKeyException e) {
            return OptionalLong.empty();
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                return OptionalLong.empty();
            }
            throw e;
        }
    }
}
