package ca.slackwater;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;

/**
 * Serves the real clips in clips/ at /clips/..., so the page can play the same footage the engine measured.
 * Only the clips folder is exposed, and only for reading.
 */
@Configuration
public class ClipFilesConfig implements WebMvcConfigurer {

    private final String clipsLocation;

    public ClipFilesConfig(@Value("${slackwater.clips-dir:clips}") String clipsDir) {
        String uri = Path.of(clipsDir).toAbsolutePath().toUri().toString();
        this.clipsLocation = uri.endsWith("/") ? uri : uri + "/";
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/clips/**").addResourceLocations(clipsLocation);
    }
}
