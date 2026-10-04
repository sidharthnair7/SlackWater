package ca.slackwater.reading;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReadingRepository extends JpaRepository<Reading, Long> {

    List<Reading> findAllByOrderByCreatedAtDesc();
}
