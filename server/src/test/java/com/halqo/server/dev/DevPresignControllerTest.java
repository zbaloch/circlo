package com.halqo.server.dev;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.halqo.server.storage.MediaUrlSigner;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** The dev presign endpoint must not exist unless the local profile is active. */
@WebMvcTest(controllers = DevPresignController.class)
class DevPresignControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private MediaUrlSigner signer;

    @Test
    void notExposedWithoutLocalProfile() throws Exception {
        mvc.perform(post("/dev/presign-put")).andExpect(status().isNotFound());
    }
}
