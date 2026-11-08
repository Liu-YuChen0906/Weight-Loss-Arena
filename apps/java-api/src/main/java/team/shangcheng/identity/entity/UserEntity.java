package team.shangcheng.identity.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

@TableName("users")
@Getter
@Setter
public class UserEntity {

    @TableId(type = IdType.INPUT)
    private String id;

    private String phone;

    private String nickname;

    private String avatar;

    private String consentVersion;

    private Instant consentAt;

    private Instant createdAt;
}
