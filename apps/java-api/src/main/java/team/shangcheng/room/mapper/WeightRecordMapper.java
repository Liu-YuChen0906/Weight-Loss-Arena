package team.shangcheng.room.mapper;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import team.shangcheng.domain.Domain;
import team.shangcheng.room.model.WeightRecord;

@Mapper
public interface WeightRecordMapper {
    @Select(
        "SELECT weight,version FROM records WHERE room_id=#{roomId} AND user_id=#{userId} AND business_date=#{date} FOR UPDATE"
    )
    @ConstructorArgs(
        {
            @Arg(column = "weight", javaType = BigDecimal.class),
            @Arg(column = "version", javaType = int.class),
        }
    )
    WeightRecord lockRecord(
        @Param("roomId") String roomId,
        @Param("userId") String userId,
        @Param("date") LocalDate date
    );

    @Insert("INSERT INTO records VALUES(#{roomId},#{userId},#{date},#{weight},1,#{now})")
    int insertRecord(
        @Param("roomId") String roomId,
        @Param("userId") String userId,
        @Param("date") LocalDate date,
        @Param("weight") BigDecimal weight,
        @Param("now") Instant now
    );

    @Update(
        "UPDATE records SET weight=#{weight},version=version+1,updated_at=#{now} WHERE room_id=#{roomId} AND user_id=#{userId} AND business_date=#{date} AND version=#{version}"
    )
    int updateRecord(
        @Param("weight") BigDecimal weight,
        @Param("now") Instant now,
        @Param("roomId") String roomId,
        @Param("userId") String userId,
        @Param("date") LocalDate date,
        @Param("version") int version
    );

    @Select(
        "SELECT business_date,weight,version FROM records WHERE room_id=#{roomId} AND user_id=#{userId} ORDER BY business_date"
    )
    @ConstructorArgs(
        {
            @Arg(column = "business_date", javaType = LocalDate.class),
            @Arg(column = "weight", javaType = BigDecimal.class),
            @Arg(column = "version", javaType = int.class),
        }
    )
    List<Domain.Reading> findReadings(
        @Param("roomId") String roomId,
        @Param("userId") String userId
    );

    @Select(
        "SELECT MAX(business_date) AS last_day FROM records WHERE room_id=#{roomId} AND user_id=#{userId}"
    )
    LocalDate findLastRecordDate(@Param("roomId") String roomId, @Param("userId") String userId);
}
