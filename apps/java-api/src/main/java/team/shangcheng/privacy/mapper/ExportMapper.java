package team.shangcheng.privacy.mapper;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import team.shangcheng.privacy.dto.PrivacyResponses.Membership;
import team.shangcheng.privacy.dto.PrivacyResponses.Reading;

@Mapper
public interface ExportMapper {
    @Select(
        "SELECT room_id,join_date,state,height,start_weight,target,algorithm FROM members WHERE user_id=#{userId}"
    )
    @ConstructorArgs(
        {
            @Arg(column = "room_id", javaType = String.class),
            @Arg(column = "join_date", javaType = LocalDate.class),
            @Arg(column = "state", javaType = String.class),
            @Arg(column = "height", javaType = BigDecimal.class),
            @Arg(column = "start_weight", javaType = BigDecimal.class),
            @Arg(column = "target", javaType = BigDecimal.class),
            @Arg(column = "algorithm", javaType = String.class),
        }
    )
    List<Membership> memberships(@Param("userId") String userId);

    @Select(
        "SELECT room_id,business_date AS date,weight,version FROM records WHERE user_id=#{userId} ORDER BY business_date"
    )
    @ConstructorArgs(
        {
            @Arg(column = "room_id", javaType = String.class),
            @Arg(column = "date", javaType = LocalDate.class),
            @Arg(column = "weight", javaType = BigDecimal.class),
            @Arg(column = "version", javaType = int.class),
        }
    )
    List<Reading> records(@Param("userId") String userId);
}
