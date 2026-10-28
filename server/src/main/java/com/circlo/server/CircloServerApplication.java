package com.circlo.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@org.springframework.scheduling.annotation.EnableScheduling
@ConfigurationPropertiesScan
public class CircloServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(CircloServerApplication.class, args);
    }
}
