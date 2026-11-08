package team.shangcheng.room.entity;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import lombok.Getter;
import lombok.Setter;

@TableName("members")
@Getter
@Setter
public class MemberEntity {

    @TableId(type = IdType.INPUT)
    private String id;

    private String roomId;

    private String userId;

    private String state;

    private Boolean ready;

    private BigDecimal height;

    private BigDecimal startWeight;

    private BigDecimal target;

    private String algorithm;

    private LocalDate joinDate;

    private Instant joinedAt;

    @TableField(insertStrategy = FieldStrategy.NEVER, updateStrategy = FieldStrategy.NEVER)
    private Long joinedOrder;
}
