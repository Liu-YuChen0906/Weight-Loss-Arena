package team.shangcheng.room.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import team.shangcheng.room.entity.MemberEntity;
import team.shangcheng.room.model.Member;

@Mapper
public interface MemberMapper extends BaseMapper<MemberEntity> {
    @Select(
        "SELECT members.*,NULL AS nickname,NULL AS avatar FROM members WHERE room_id=#{roomId} AND user_id=#{userId} AND state='JOINED'"
    )
    @ConstructorArgs(
        {
            @Arg(column = "id", javaType = String.class),
            @Arg(column = "room_id", javaType = String.class),
            @Arg(column = "user_id", javaType = String.class),
            @Arg(column = "ready", javaType = boolean.class),
            @Arg(column = "height", javaType = BigDecimal.class),
            @Arg(column = "start_weight", javaType = BigDecimal.class),
            @Arg(column = "target", javaType = BigDecimal.class),
            @Arg(column = "algorithm", javaType = String.class),
            @Arg(column = "join_date", javaType = LocalDate.class),
            @Arg(column = "joined_order", javaType = int.class),
            @Arg(column = "nickname", javaType = String.class),
            @Arg(column = "avatar", javaType = String.class),
        }
    )
    Member findMember(@Param("roomId") String roomId, @Param("userId") String userId);

    @Select(
        "SELECT id FROM members WHERE room_id=#{roomId} AND user_id=#{userId} AND state='JOINED'"
    )
    String findJoinedMemberId(@Param("roomId") String roomId, @Param("userId") String userId);

    @Select(
        "SELECT user_id FROM members WHERE room_id=#{roomId} AND state='JOINED' ORDER BY joined_order LIMIT 1"
    )
    String findNextOwner(@Param("roomId") String roomId);

    @Select("SELECT ready FROM members WHERE room_id=#{roomId} AND state='JOINED'")
    List<Boolean> findReadiness(@Param("roomId") String roomId);

    @Select(
        "SELECT m.*,u.nickname,u.avatar FROM members m JOIN users u ON u.id=m.user_id WHERE m.room_id=#{roomId} AND m.state='JOINED' ORDER BY m.joined_order"
    )
    @ConstructorArgs(
        {
            @Arg(column = "id", javaType = String.class),
            @Arg(column = "room_id", javaType = String.class),
            @Arg(column = "user_id", javaType = String.class),
            @Arg(column = "ready", javaType = boolean.class),
            @Arg(column = "height", javaType = BigDecimal.class),
            @Arg(column = "start_weight", javaType = BigDecimal.class),
            @Arg(column = "target", javaType = BigDecimal.class),
            @Arg(column = "algorithm", javaType = String.class),
            @Arg(column = "join_date", javaType = LocalDate.class),
            @Arg(column = "joined_order", javaType = int.class),
            @Arg(column = "nickname", javaType = String.class),
            @Arg(column = "avatar", javaType = String.class),
        }
    )
    List<Member> findMembersWithProfiles(@Param("roomId") String roomId);

    @Select(
        "SELECT members.*,NULL AS nickname,NULL AS avatar FROM members WHERE id=#{memberId} AND room_id=#{roomId} AND state='JOINED'"
    )
    @ConstructorArgs(
        {
            @Arg(column = "id", javaType = String.class),
            @Arg(column = "room_id", javaType = String.class),
            @Arg(column = "user_id", javaType = String.class),
            @Arg(column = "ready", javaType = boolean.class),
            @Arg(column = "height", javaType = BigDecimal.class),
            @Arg(column = "start_weight", javaType = BigDecimal.class),
            @Arg(column = "target", javaType = BigDecimal.class),
            @Arg(column = "algorithm", javaType = String.class),
            @Arg(column = "join_date", javaType = LocalDate.class),
            @Arg(column = "joined_order", javaType = int.class),
            @Arg(column = "nickname", javaType = String.class),
            @Arg(column = "avatar", javaType = String.class),
        }
    )
    Member findMemberById(@Param("memberId") String memberId, @Param("roomId") String roomId);
}
