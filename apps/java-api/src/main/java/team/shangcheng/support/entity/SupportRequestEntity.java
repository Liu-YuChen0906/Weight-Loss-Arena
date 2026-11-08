package team.shangcheng.support.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

@TableName("support_requests")
@Getter
@Setter
public class SupportRequestEntity {

    @TableId(type = IdType.INPUT)
    private String id;

    private String userId;

    private String message;

    private String status;

    private Instant createdAt;

    private Instant resolvedAt;

    private String resolvedBy;
}
