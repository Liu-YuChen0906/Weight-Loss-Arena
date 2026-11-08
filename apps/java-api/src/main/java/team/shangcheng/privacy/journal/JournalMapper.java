package team.shangcheng.privacy.journal;

import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** Registered only on the independent journal factory, never on the business datasource. */
public interface JournalMapper {
    record Event(long sequence, String userId) {}

    @Select("SELECT GET_LOCK('shangcheng_java_privacy_gate',5)")
    Integer acquireGate();

    @Select("SELECT RELEASE_LOCK('shangcheng_java_privacy_gate')")
    Integer releaseGate();

    @Select("SELECT journal_id FROM identity WHERE id=1")
    String identity();

    @Select("SELECT COALESCE(MAX(sequence),0) FROM events")
    long lastSequence();

    @Select("SELECT sequence,user_id FROM events WHERE sequence>#{last} ORDER BY sequence")
    @ConstructorArgs(
        {
            @Arg(column = "sequence", javaType = long.class),
            @Arg(column = "user_id", javaType = String.class),
        }
    )
    List<Event> eventsAfter(@Param("last") long last);

    @Insert(
        "INSERT INTO events(event_id,user_id,created_at) VALUES(#{eventId},#{userId},#{createdAt})"
    )
    int append(
        @Param("eventId") String eventId,
        @Param("userId") String userId,
        @Param("createdAt") Instant createdAt
    );
}
