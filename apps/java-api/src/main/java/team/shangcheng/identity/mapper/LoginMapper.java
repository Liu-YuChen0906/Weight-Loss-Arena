package team.shangcheng.identity.mapper;

import java.time.Instant;
import java.time.LocalDate;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import team.shangcheng.identity.model.Otp;
import team.shangcheng.identity.model.RateLimit;

@Mapper
public interface LoginMapper {
    @Insert("INSERT IGNORE INTO rate_limits VALUES(#{key},0,#{resetAt})")
    int initializeLimit(@Param("key") String key, @Param("resetAt") Instant resetAt);

    @Select("SELECT count,reset_at FROM rate_limits WHERE rate_key=#{key} FOR UPDATE")
    @ConstructorArgs(
        {
            @Arg(column = "count", javaType = int.class),
            @Arg(column = "reset_at", javaType = Instant.class),
        }
    )
    RateLimit lockLimit(@Param("key") String key);

    @Update("UPDATE rate_limits SET count=1,reset_at=#{resetAt} WHERE rate_key=#{key}")
    int resetLimit(@Param("key") String key, @Param("resetAt") Instant resetAt);

    @Update("UPDATE rate_limits SET count=count+1 WHERE rate_key=#{key}")
    int incrementLimit(@Param("key") String key);

    @Select(
        "<script>SELECT * FROM otp_dispatches WHERE phone=#{phone}<if test=\"lock\"> FOR UPDATE</if></script>"
    )
    @ConstructorArgs(
        {
            @Arg(column = "dispatch_id", javaType = String.class),
            @Arg(column = "credential_marker", javaType = String.class),
            @Arg(column = "delivery_state", javaType = String.class),
            @Arg(column = "expires_at", javaType = Instant.class),
            @Arg(column = "sent_at", javaType = Instant.class),
            @Arg(column = "attempts", javaType = int.class),
        }
    )
    Otp findOtp(@Param("phone") String phone, @Param("lock") boolean lock);

    @Insert(
        "INSERT INTO otp_dispatches(phone,credential_marker,dispatch_id,method,delivery_state,expires_at,sent_at,attempts) VALUES(#{phone},#{marker},#{dispatchId},'LOCAL','DEVELOPMENT',#{expiresAt},#{sentAt},0) ON DUPLICATE KEY UPDATE credential_marker=VALUES(credential_marker),dispatch_id=VALUES(dispatch_id),delivery_state='DEVELOPMENT',expires_at=VALUES(expires_at),sent_at=VALUES(sent_at),attempts=0"
    )
    int saveOtp(
        @Param("phone") String phone,
        @Param("marker") String marker,
        @Param("dispatchId") String dispatchId,
        @Param("expiresAt") Instant expiresAt,
        @Param("sentAt") Instant sentAt
    );

    @Update("UPDATE otp_dispatches SET attempts=attempts+1 WHERE phone=#{phone}")
    int incrementOtpAttempts(@Param("phone") String phone);

    @Delete("DELETE FROM otp_dispatches WHERE phone=#{phone}")
    int deleteOtp(@Param("phone") String phone);

    @Insert(
        """
        INSERT IGNORE INTO otp_dispatches (phone, credential_marker, dispatch_id, method, delivery_state, expires_at, sent_at)
        VALUES (#{phone}, '', #{dispatch}, 'PNVS', 'PENDING', #{expires}, #{now})
        """
    )
    int insertSms(
        @Param("phone") String phone,
        @Param("dispatch") String dispatch,
        @Param("expires") Instant expires,
        @Param("now") Instant now
    );

    @Update(
        """
        UPDATE otp_dispatches
        SET credential_marker='', dispatch_id=#{dispatch}, method='PNVS', delivery_state='PENDING',
            expires_at=#{expires}, sent_at=#{now}, attempts=0, verify_lease_token=NULL, verify_lease_until=NULL
        WHERE phone=#{phone} AND sent_at <= #{cutoff}
          AND (verify_lease_until IS NULL OR verify_lease_until <= #{now})
        """
    )
    int replaceSms(
        @Param("phone") String phone,
        @Param("dispatch") String dispatch,
        @Param("expires") Instant expires,
        @Param("now") Instant now,
        @Param("cutoff") Instant cutoff
    );

    @Insert(
        """
        INSERT IGNORE INTO sms_daily_usage (business_date, count) VALUES (#{day}, 0)
        """
    )
    int initializeSmsBudget(@Param("day") LocalDate day);

    @Update(
        """
        UPDATE sms_daily_usage SET count=count+1 WHERE business_date=#{day} AND count < #{maximum}
        """
    )
    int spendSmsBudget(@Param("day") LocalDate day, @Param("maximum") int maximum);

    @Update(
        """
        UPDATE otp_dispatches SET delivery_state=#{state}
        WHERE phone=#{phone} AND dispatch_id=#{dispatch} AND delivery_state='PENDING'
        """
    )
    int finishSms(
        @Param("phone") String phone,
        @Param("dispatch") String dispatch,
        @Param("state") String state
    );

    @Update(
        """
        UPDATE otp_dispatches
        SET verify_lease_token=#{token}, verify_lease_until=#{until}, attempts=attempts+1
        WHERE phone=#{phone} AND dispatch_id=#{dispatch} AND delivery_state='ACCEPTED'
          AND expires_at > #{now} AND attempts < 5
          AND (verify_lease_until IS NULL OR verify_lease_until <= #{now})
        """
    )
    int leaseSms(
        @Param("phone") String phone,
        @Param("dispatch") String dispatch,
        @Param("token") String token,
        @Param("now") Instant now,
        @Param("until") Instant until
    );

    @Update(
        """
        UPDATE otp_dispatches
        SET verify_lease_token=NULL, verify_lease_until=NULL, delivery_state=#{state}
        WHERE phone=#{phone} AND dispatch_id=#{dispatch} AND verify_lease_token=#{token}
        """
    )
    int finishSmsVerification(
        @Param("phone") String phone,
        @Param("dispatch") String dispatch,
        @Param("token") String token,
        @Param("state") String state
    );

    @Update(
        """
        UPDATE otp_dispatches
        SET delivery_state='CONSUMED', verify_lease_token=NULL, verify_lease_until=NULL
        WHERE phone=#{phone} AND dispatch_id=#{dispatch} AND verify_lease_token=#{token}
          AND verify_lease_until > #{now} AND expires_at > #{now}
        """
    )
    int consumeSms(
        @Param("phone") String phone,
        @Param("dispatch") String dispatch,
        @Param("token") String token,
        @Param("now") Instant now
    );
}
