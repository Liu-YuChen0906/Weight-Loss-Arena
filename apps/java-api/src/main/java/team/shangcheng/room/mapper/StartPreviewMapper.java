package team.shangcheng.room.mapper;

import java.time.LocalDate;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import team.shangcheng.room.model.StartPreview;

@Mapper
public interface StartPreviewMapper {
    @Insert(
        "INSERT INTO start_previews VALUES(#{roomId},#{userId},#{version},#{date},#{expiresAt}) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),version=VALUES(version),business_date=VALUES(business_date),expires_at=VALUES(expires_at)"
    )
    int saveStartPreview(
        @Param("roomId") String roomId,
        @Param("userId") String userId,
        @Param("version") int version,
        @Param("date") LocalDate date,
        @Param("expiresAt") long expiresAt
    );

    @Select("SELECT * FROM start_previews WHERE room_id=#{roomId} AND user_id=#{userId}")
    @ConstructorArgs(
        {
            @Arg(column = "version", javaType = int.class),
            @Arg(column = "business_date", javaType = LocalDate.class),
            @Arg(column = "expires_at", javaType = long.class),
        }
    )
    StartPreview findStartPreview(@Param("roomId") String roomId, @Param("userId") String userId);

    @Delete("DELETE FROM start_previews WHERE room_id=#{roomId}")
    int deleteStartPreview(@Param("roomId") String roomId);
}
