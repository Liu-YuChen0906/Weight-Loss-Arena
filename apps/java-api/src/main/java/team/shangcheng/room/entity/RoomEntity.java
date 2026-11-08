package team.shangcheng.room.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.Instant;
import java.time.LocalDate;
import lombok.Getter;
import lombok.Setter;

@TableName("rooms")
@Getter
@Setter
public class RoomEntity {

    @TableId(type = IdType.INPUT)
    private String id;

    private String name;

    private String intro;

    private Integer days;

    private String intensity;

    private String status;

    private String ownerId;

    private String inviteCode;

    private Integer version;

    private LocalDate startDate;

    private Instant createdAt;
}
