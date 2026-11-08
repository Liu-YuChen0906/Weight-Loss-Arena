package team.shangcheng.room.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import team.shangcheng.room.dto.RoomResponses;
import team.shangcheng.room.entity.RoomEntity;
import team.shangcheng.room.model.Room;

@Mapper
public interface RoomMapper extends BaseMapper<RoomEntity> {
    @Select(
        "SELECT id FROM rooms WHERE status='ACTIVE' AND DATE_ADD(start_date,INTERVAL days DAY)<=#{today} ORDER BY id FOR UPDATE"
    )
    List<String> lockExpiredRooms(@Param("today") LocalDate today);

    @Update(
        "UPDATE rooms SET status='ENDED',version=version+1 WHERE id=#{roomId} AND status='ACTIVE'"
    )
    int endRoom(@Param("roomId") String roomId);

    @Select("<script>SELECT * FROM rooms WHERE id=#{id}<if test=\"lock\"> FOR UPDATE</if></script>")
    @ConstructorArgs(
        {
            @Arg(column = "id", javaType = String.class),
            @Arg(column = "name", javaType = String.class),
            @Arg(column = "intro", javaType = String.class),
            @Arg(column = "days", javaType = int.class),
            @Arg(column = "intensity", javaType = String.class),
            @Arg(column = "status", javaType = String.class),
            @Arg(column = "owner_id", javaType = String.class),
            @Arg(column = "invite_code", javaType = String.class),
            @Arg(column = "version", javaType = int.class),
            @Arg(column = "start_date", javaType = LocalDate.class),
        }
    )
    Room findRoom(@Param("id") String id, @Param("lock") boolean lock);

    @Update("UPDATE rooms SET version=version+1 WHERE id=#{roomId}")
    int incrementVersion(@Param("roomId") String roomId);

    @Select(
        "<script>SELECT * FROM rooms WHERE invite_code=#{code}<if test=\"lock\"> FOR UPDATE</if></script>"
    )
    @ConstructorArgs(
        {
            @Arg(column = "id", javaType = String.class),
            @Arg(column = "name", javaType = String.class),
            @Arg(column = "intro", javaType = String.class),
            @Arg(column = "days", javaType = int.class),
            @Arg(column = "intensity", javaType = String.class),
            @Arg(column = "status", javaType = String.class),
            @Arg(column = "owner_id", javaType = String.class),
            @Arg(column = "invite_code", javaType = String.class),
            @Arg(column = "version", javaType = int.class),
            @Arg(column = "start_date", javaType = LocalDate.class),
        }
    )
    Room findByInviteCode(@Param("code") String code, @Param("lock") boolean lock);

    @Update(
        "UPDATE rooms SET name=#{name},intro=#{intro},days=#{days},version=version+1 WHERE id=#{roomId}"
    )
    int updateRoom(
        @Param("name") String name,
        @Param("intro") String intro,
        @Param("days") int days,
        @Param("roomId") String roomId
    );

    @Update("UPDATE rooms SET status='CANCELLED',version=version+1 WHERE id=#{roomId}")
    int cancelRoom(@Param("roomId") String roomId);

    @Update("UPDATE rooms SET owner_id=#{userId},version=version+1 WHERE id=#{roomId}")
    int transferOwner(@Param("userId") String userId, @Param("roomId") String roomId);

    @Update(
        "UPDATE rooms SET status='ACTIVE',start_date=#{date},version=version+1 WHERE id=#{roomId} AND status='LOBBY'"
    )
    int startRoom(@Param("date") LocalDate date, @Param("roomId") String roomId);

    @Select(
        "SELECT r.id,r.name,r.start_date AS startDate,r.days,r.intensity FROM rooms r JOIN members m ON m.room_id=r.id AND m.user_id=#{userId} AND m.state='JOINED' WHERE r.status='ENDED' ORDER BY r.start_date DESC,r.created_at DESC LIMIT 100"
    )
    @ConstructorArgs(
        {
            @Arg(column = "id", javaType = String.class),
            @Arg(column = "name", javaType = String.class),
            @Arg(column = "startDate", javaType = LocalDate.class),
            @Arg(column = "days", javaType = int.class),
            @Arg(column = "intensity", javaType = String.class),
        }
    )
    List<RoomResponses.HistoryRoom> findHistory(@Param("userId") String userId);
}
