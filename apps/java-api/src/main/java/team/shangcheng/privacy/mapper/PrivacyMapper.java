package team.shangcheng.privacy.mapper;

import java.util.List;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/** Business-schema erasure statements run in the caller's Spring transaction. */
@Mapper
public interface PrivacyMapper {
    record Meta(String journalId, long lastSequence) {}

    record RoomOwner(String status, String ownerId) {}

    @Select("SELECT journal_id,last_sequence FROM privacy_meta WHERE id=1")
    @ConstructorArgs(
        {
            @Arg(column = "journal_id", javaType = String.class),
            @Arg(column = "last_sequence", javaType = long.class),
        }
    )
    Meta meta();

    @Select("SELECT COUNT(*) FROM users")
    int userCount();

    @Insert("INSERT INTO privacy_meta(id,journal_id,last_sequence) VALUES(1,#{identity},0)")
    int bind(@Param("identity") String identity);

    @Update("UPDATE privacy_meta SET last_sequence=#{sequence} WHERE id=1")
    int advance(@Param("sequence") long sequence);

    @Select("SELECT DISTINCT room_id FROM members WHERE user_id=#{userId}")
    List<String> rooms(@Param("userId") String userId);

    @Select("SELECT phone FROM users WHERE id=#{userId}")
    String phone(@Param("userId") String userId);

    @Delete("DELETE FROM reminder_receipts WHERE room_id=#{roomId}")
    int deleteReceipts(@Param("roomId") String roomId);

    @Update("UPDATE rooms SET version=version+1 WHERE id=#{roomId}")
    int invalidateRoom(@Param("roomId") String roomId);

    @Delete("DELETE FROM active_memberships WHERE user_id=#{userId}")
    int deleteMemberships(@Param("userId") String userId);

    @Delete("DELETE FROM start_previews WHERE user_id=#{userId}")
    int deletePreviews(@Param("userId") String userId);

    @Delete("DELETE FROM records WHERE user_id=#{userId}")
    int deleteRecords(@Param("userId") String userId);

    @Delete("DELETE FROM support_requests WHERE user_id=#{userId}")
    int deleteSupport(@Param("userId") String userId);

    @Delete("DELETE FROM idempotency WHERE user_id=#{userId} OR operation LIKE 'reminders:%'")
    int deleteIdempotency(@Param("userId") String userId);

    @Delete("DELETE FROM members WHERE user_id=#{userId}")
    int deleteMembers(@Param("userId") String userId);

    @Delete("DELETE FROM otp_dispatches WHERE phone=#{phone}")
    int deleteOtp(@Param("phone") String phone);

    @Delete("DELETE FROM users WHERE id=#{userId}")
    int deleteUser(@Param("userId") String userId);

    @Select("SELECT status,owner_id FROM rooms WHERE id=#{roomId}")
    @ConstructorArgs(
        {
            @Arg(column = "status", javaType = String.class),
            @Arg(column = "owner_id", javaType = String.class),
        }
    )
    RoomOwner room(@Param("roomId") String roomId);

    @Select(
        "SELECT user_id FROM members WHERE room_id=#{roomId} AND state='JOINED' ORDER BY joined_order LIMIT 1"
    )
    String nextOwner(@Param("roomId") String roomId);

    @Update("UPDATE rooms SET status='CANCELLED' WHERE id=#{roomId}")
    int cancelRoom(@Param("roomId") String roomId);

    @Update("UPDATE rooms SET owner_id=#{userId} WHERE id=#{roomId}")
    int transferOwner(@Param("roomId") String roomId, @Param("userId") String userId);
}
