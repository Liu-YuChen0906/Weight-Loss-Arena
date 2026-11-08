package team.shangcheng.room.mapper;

import java.time.LocalDate;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface ReminderReceiptMapper {
    @Select(
        "SELECT stage FROM reminder_receipts WHERE room_id=#{roomId} AND recipient_id=#{recipientId} AND member_id=#{memberId} AND ((round_date=#{round} AND stage=#{stage}) OR shown_date=#{shownDate}) LIMIT 1"
    )
    Integer findReminderReceipt(
        @Param("roomId") String roomId,
        @Param("recipientId") String recipientId,
        @Param("memberId") String memberId,
        @Param("round") LocalDate round,
        @Param("stage") int stage,
        @Param("shownDate") LocalDate shownDate
    );

    @Insert(
        "INSERT INTO reminder_receipts VALUES(#{roomId},#{recipientId},#{memberId},#{round},#{stage},#{shownDate})"
    )
    int insertReminderReceipt(
        @Param("roomId") String roomId,
        @Param("recipientId") String recipientId,
        @Param("memberId") String memberId,
        @Param("round") LocalDate round,
        @Param("stage") int stage,
        @Param("shownDate") LocalDate shownDate
    );
}
