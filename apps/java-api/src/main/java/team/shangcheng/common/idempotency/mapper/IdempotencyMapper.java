package team.shangcheng.common.idempotency.mapper;

import java.time.Instant;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import team.shangcheng.common.idempotency.model.StoredResult;

@Mapper
public interface IdempotencyMapper {
    @Select("SELECT id FROM users WHERE id=#{userId} FOR UPDATE")
    String lockUser(@Param("userId") String userId);

    @Select(
        "SELECT operation,body_hash,result_json FROM idempotency WHERE user_id=#{userId} AND request_key=#{key}"
    )
    @ConstructorArgs(
        {
            @Arg(column = "operation", javaType = String.class),
            @Arg(column = "body_hash", javaType = String.class),
            @Arg(column = "result_json", javaType = String.class),
        }
    )
    StoredResult find(@Param("userId") String userId, @Param("key") String key);

    @Insert(
        "INSERT INTO idempotency VALUES(#{userId},#{key},#{operation},#{bodyHash},#{result},#{now})"
    )
    int insert(
        @Param("userId") String userId,
        @Param("key") String key,
        @Param("operation") String operation,
        @Param("bodyHash") String bodyHash,
        @Param("result") String result,
        @Param("now") Instant now
    );
}
