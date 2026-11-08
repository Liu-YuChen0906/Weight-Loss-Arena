package team.shangcheng.identity.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import team.shangcheng.identity.entity.UserEntity;

@Mapper
public interface UserMapper extends BaseMapper<UserEntity> {
    @Select("SELECT room_id FROM active_memberships WHERE user_id=#{userId}")
    String findCurrentRoomId(@Param("userId") String userId);
}
