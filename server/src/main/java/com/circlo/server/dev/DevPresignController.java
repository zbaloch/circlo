package com.circlo.server.dev;

import com.circlo.server.storage.MediaUrlSigner;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Phase 0 smoke test only: hands out a presigned PUT so a phone can prove it reaches MinIO.
 * Exists only under the {@code local} profile; never deployed.
 */
@Profile("local")
@RestController
public class DevPresignController {

    private final MediaUrlSigner signer;

    public DevPresignController(MediaUrlSigner signer) {
        this.signer = signer;
    }

    @PostMapping("/dev/presign-put")
    public Map<String, String> presignPut() {
        String key = MediaUrlSigner.newObjectKey();
        return Map.of(
                "objectKey", key,
                "putUrl", signer.presignPut(key).toString(),
                "getUrl", signer.presignGet(key).toString());
    }
}
